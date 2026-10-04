import Image from "next/image";

type PeakArtworkProps = {
  name?: string | null;
  imagePath?: string | null;
  className?: string;
  sizes?: string;
  priority?: boolean;
};

export function PeakArtwork({ name, imagePath, className = "", sizes = "80px", priority = false }: PeakArtworkProps) {
  return (
    <span className={`${imagePath ? "bg-[#f1ebdf]" : "topographic-placeholder"} relative block overflow-hidden ${className}`}>
      {imagePath && (
        <Image
          src={imagePath}
          alt={name ? `Illustrated landscape of ${name}` : "Illustrated mountain landscape"}
          fill
          sizes={sizes}
          preload={priority}
          className="object-contain"
        />
      )}
    </span>
  );
}
