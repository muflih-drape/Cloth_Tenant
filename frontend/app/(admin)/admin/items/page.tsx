import ListItems from "@/components/pages/admin/items/ListItems";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

  return (
    <div className="min-h-screen min-w-full">
      <ListItems
        initialTab={tab === "ordered" ? "ordered" : undefined}
      />
    </div>
  );
}