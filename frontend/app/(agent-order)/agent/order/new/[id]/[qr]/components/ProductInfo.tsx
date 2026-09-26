"use client";

interface ProductInfoProps {
  name: string | undefined;
}

export default function ProductInfo({ name }: ProductInfoProps) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-black text-gray-900 mb-1">{name}</h2>
      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-tight">
        {"Premium Collection"}
      </p>
    </div>
  );
}