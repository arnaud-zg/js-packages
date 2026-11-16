/** `1 version`, `3 versions`. */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
