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
    <span className={`topographic-placeholder relative block overflow-hidden ${className}`}>
      {imagePath && (
        <Image
          src={imagePath}
          alt={name ? `Stylised terrain profile of ${name}` : "Stylised mountain terrain profile"}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      )}
    </span>
  );
}
