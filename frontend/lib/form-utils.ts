/**
 * Flatten a nested object into FormData compatible with Django REST Framework's multipart parser.
 * Handles nested arrays and objects like `variants[0]image`.
 */
export function objectToFormData(
  obj: Record<string, any>,
  rootName?: string,
  ignoreList?: string[],
): FormData {
  const formData = new FormData();

  function appendFormData(data: any, root: string) {
    if (!data) return;

    if (ignoreList && ignoreList.indexOf(root) !== -1) return;

    if (data instanceof File) {
      formData.append(root, data);
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        appendFormData(data[i], `${root}[${i}]`);
      }
    } else if (typeof data === "object" && data !== null) {
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const newRoot = root ? `${root}[${key}]` : key;
          appendFormData(data[key], newRoot);
        }
      }
    } else {
      if (data !== undefined && data !== null) {
        formData.append(root, data.toString());
      }
    }
  }

  appendFormData(obj, rootName || "");

  return formData;
}

/**
 * Build the multipart body for `CreateFabricSerializer` / `UpdateFabricSerializer`.
 *
 * A variant is one colour, so it carries its own `stock_meters` and nothing
 * else -- there is no nested size list to flatten.
 *
 * Two subtleties on update, both of which silently do nothing if you skip them:
 *  - `display_order` has to be sent even when blank, because the API only
 *    rewrites a label when the key is present. Omitting it keeps the old label.
 *  - `remove_image` is the only way to clear a photo; an absent `image` simply
 *    means "leave the existing one alone".
 */
export function fabricToFormData(data: Record<string, any>): FormData {
  const formData = new FormData();

  formData.append("name", data.name as string);
  formData.append("description", (data.description as string) || "");
  formData.append("price_per_meter", String(data.price_per_meter));

  (
    data.variants as Array<{
      id?: number;
      image?: File | string | null;
      display_order?: string | null;
      stock_meters?: string | number | null;
      remove_image?: boolean;
    }>
  ).forEach((variant, index: number) => {
    if (variant.id !== undefined && variant.id !== null) {
      formData.append(`variants[${index}]id`, String(variant.id));
    }
    // Only a freshly picked file is an upload. An existing photo already lives
    // on the server, so its URL is never sent back as if it were a new file.
    if (variant.image instanceof File) {
      formData.append(`variants[${index}]image`, variant.image);
    }
    if (variant.remove_image) {
      formData.append(`variants[${index}]remove_image`, "true");
    }
    // Present-but-blank clears the label: the API reads "" as "no label".
    if (variant.display_order !== undefined) {
      formData.append(
        `variants[${index}]display_order`,
        variant.display_order ?? "",
      );
    }
    // Stock is sent for every colour, existing or new: the API applies it in
    // both cases and records a change on the roll's stock cursor.
    formData.append(
      `variants[${index}]stock_meters`,
      String(variant.stock_meters ?? 0),
    );
  });

  return formData;
}
