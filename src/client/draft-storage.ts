export function draftStorageKey(controlOrigin: string, roomID: string, participantID: string) {
  return `relay:draft:${encodeURIComponent(controlOrigin)}:${encodeURIComponent(roomID)}:${encodeURIComponent(participantID)}`;
}

export function readDraft(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, text: string): boolean {
  try {
    if (text) {
      window.sessionStorage.setItem(key, text);
    } else {
      window.sessionStorage.removeItem(key);
    }

    return true;
  } catch {
    return false;
  }
}
