import type { CSSProperties } from "react";
import { brandInitial, useBrand } from "@/lib/brand";

/** The brand's logo (ours, or an agency's), or the agency's initial when it has no logo. */
export function BrandMark({ className = "w-10 h-10", style }: { className?: string; style?: CSSProperties }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    return <img src={brand.logoUrl} className={`${className} object-contain`} alt={brand.name} style={style} />;
  }
  return (
    <span
      className={`${className} grid place-items-center rounded-xl font-bold text-white`}
      style={{ background: brand.primaryColor || "#0f766e", ...style }}
      aria-label={brand.name}
    >
      {brandInitial(brand)}
    </span>
  );
}
