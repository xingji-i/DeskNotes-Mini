/** 按测量宽度换行，保留 Unicode 码点及显式换行。 */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const character of paragraph) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
