/** Public compile-time values from puzzle.config.js; apps can augment this interface. */
interface ImportMetaEnv {
 readonly [key: string]: string | number | boolean | undefined;
}

interface ImportMeta {
 readonly env: ImportMetaEnv;
}
