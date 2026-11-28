/**
 * Brand monogram. The PNG is a white alpha mask (public/brand/monogram.png, made by
 * assets/images/prepare_images.py), painted in `currentColor` so it follows the text colour it sits in.
 */
export function Monogram({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        WebkitMaskImage: 'url(/brand/monogram.png)',
        maskImage: 'url(/brand/monogram.png)',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
