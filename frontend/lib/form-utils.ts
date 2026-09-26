/**
 * Flatten a nested object into FormData compatible with Django REST Framework's multipart parser.
 * Handles nested arrays and objects like `variants[0]image` or `sizes[0]size`.
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
 * Specifically tailored for ItemRequest structure in Django
 */
export function itemToFormData(data: Record<string, any>): FormData {
  const formData = new FormData();

  formData.append("name", data.name as string);
  formData.append("description", (data.description as string) || "");
  formData.append("price", String(data.price));
  formData.append("type", data.type as string);

  if (data.brand_id !== undefined && data.brand_id !== null) {
    formData.append("brand_id", String(data.brand_id));
  }

  (
    data.variants as Array<{
      image?: File;
      sizes: Array<{ size: string; stock: number }>;
      display_order: string;
    }>
  ).forEach((variant, index: number) => {
    if (variant.image) {
      formData.append(`variants[${index}]image`, variant.image);
    }
    if (variant.display_order) {
      formData.append(`variants[${index}]display_order`, variant.display_order);
    }
    variant.sizes.forEach((size, sizeIndex: number) => {
      formData.append(`variants[${index}]sizes[${sizeIndex}]size`, size.size);
      formData.append(
        `variants[${index}]sizes[${sizeIndex}]stock`,
        size.stock.toString(),
      );
    });
  });

  return formData;
}
