export const formatShortDate = (date: Date): string =>
  `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;

export const formatFileDate = (date: Date): string =>
  `${date.getFullYear()}${formatShortDate(date).replace(".", "")}`;
