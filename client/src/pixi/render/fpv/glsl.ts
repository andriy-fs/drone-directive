/**
 * Identity template tag for shader sources.
 *
 * It does nothing at runtime — the string comes out exactly as written, and
 * `String.raw` is the honest spelling of that for a language with no backslash
 * escapes. Its whole job is the tag *name*: the `boyswan.glsl-literal` VS Code
 * extension highlights any template literal tagged `glsl`, `glslify`, `frag` or
 * `vert`, which turns the shader blocks in this folder from one flat string into
 * readable code.
 *
 * Keep the tag glued to the backtick and the first character of the source where
 * it matters: `precision highp float;` must still literally start the fragment
 * text (see `ground/shader.ts`), and a tag adds no characters of its own.
 */
export const glsl = String.raw;
