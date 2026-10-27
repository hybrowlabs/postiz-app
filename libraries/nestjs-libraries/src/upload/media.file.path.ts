/** Only for MIME detection and filenames. Keep the original signed URL for IO. */
export const mediaFilePath = (path: string): string => path.split(/[?#]/, 1)[0];
