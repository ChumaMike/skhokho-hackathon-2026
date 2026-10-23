import styles from "./StorefrontPreviewFrames.module.css";

/**
 * A draft page at phone and desktop widths, side by side — the same
 * frames the AI draft page uses, shared so the pages editor shows exactly
 * what a customer would see before anything goes live. The desktop frame
 * is a fixed 1280×800 viewport scaled down, so the layout is the real one.
 */
export default function StorefrontPreviewFrames({ src, title }: { src: string; title: string }) {
  return (
    <div className={styles.previews}>
      <figure className={styles.previewPhone}>
        <iframe src={src} title={`${title} — phone preview`} className={styles.framePhone} loading="lazy" />
        <figcaption>Phone</figcaption>
      </figure>
      <figure className={styles.previewDesktop}>
        <div className={styles.desktopViewport}>
          <iframe src={src} title={`${title} — desktop preview`} className={styles.frameDesktop} loading="lazy" />
        </div>
        <figcaption>Desktop</figcaption>
      </figure>
      <p className={styles.open}>
        <a href={src} target="_blank" rel="noopener noreferrer">
          Open the preview full screen ↗
        </a>
      </p>
    </div>
  );
}
