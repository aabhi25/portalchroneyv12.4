export function convertLatexDelimiters(text: string): string {
  return text
    .replace(/\\\[([^]*?)\\\]/g, (_match, math) => `$$${math}$$`)
    .replace(/\\\(([^]*?)\\\)/g, (_match, math) => `$${math}$`);
}
