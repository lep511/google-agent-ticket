/**
 * Static dotted background.
 *
 * Previously this was a canvas animated with requestAnimationFrame (redrawing
 * thousands of arcs every frame). It is now a single CSS radial-gradient tile,
 * so it costs nothing at runtime while keeping the same subtle dot texture.
 */
export function DottedBackground() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      style={{
        backgroundImage:
          'radial-gradient(rgba(204, 204, 204, 0.22) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        backgroundPosition: '15px 15px',
        // Fades the dots out towards the top, matching the old vertical falloff.
        maskImage:
          'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,1))',
        WebkitMaskImage:
          'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,1))',
      }}
    />
  );
}

/** @deprecated Kept for backwards compatibility, no longer animated. */
export const PulsatingDotsBackground = DottedBackground;
