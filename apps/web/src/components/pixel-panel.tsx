import type { HTMLAttributes } from "react";

export function PixelPanel({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={`pixel-panel ${className}`}>
      <div className="pixel-frame" aria-hidden="true">
        <div className="pixel-corner top-left" />
        <div className="pixel-corner top-right" />
        <div className="pixel-corner bottom-left" />
        <div className="pixel-corner bottom-right" />
        <div className="pixel-edge edge-top-left" />
        <div className="pixel-edge edge-top-right" />
        <div className="pixel-edge edge-bottom-left" />
        <div className="pixel-edge edge-bottom-right" />
        <div className="pixel-side side-left" />
        <div className="pixel-side side-right" />
      </div>
      {children}
    </section>
  );
}
