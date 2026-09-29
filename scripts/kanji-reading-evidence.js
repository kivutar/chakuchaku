function katakanaToHiragana(text) {
  return text.replace(/[ァ-ヶ]/gu, (character) => {
    return String.fromCharCode(character.charCodeAt(0) - 0x60);
  });
}

function normalizeReading(
  value,
  { foldVoicing = false, foldSmallTsu = false } = {}
) {
  let normalized = katakanaToHiragana(String(value || ""))
    .replace(/[～〜]/gu, "")
    .normalize("NFD");

  if (foldVoicing) {
    normalized = normalized.replace(/[\u3099\u309a]/gu, "");
  }

  normalized = normalized.normalize("NFC");

  return foldSmallTsu ? normalized.replaceAll("っ", "つ") : normalized;
}

function surfaceCarriesReading(
  surface,
  wordReading,
  character,
  targetReading,
  options = {}
) {
  const normalizedSurface = String(surface || "").replace(/[～〜]/gu, "");
  const characters = [...normalizedSurface];
  const targetIndexes = characters
    .map((candidate, index) => candidate === character ? index : -1)
    .filter((index) => index !== -1);

  if (targetIndexes.length !== 1) {
    return false;
  }

  const targetIndex = targetIndexes[0];
  const hanIndexes = characters
    .map((candidate, index) => /\p{Script=Han}/u.test(candidate) ? index : -1)
    .filter((index) => index !== -1);
  const hanPosition = hanIndexes.indexOf(targetIndex);

  if (hanPosition === -1) {
    return false;
  }

  const previousHanIndex = hanPosition > 0 ? hanIndexes[hanPosition - 1] : -1;
  const nextHanIndex = hanPosition < hanIndexes.length - 1
    ? hanIndexes[hanPosition + 1]
    : characters.length;
  const writtenPrefix = characters.slice(previousHanIndex + 1, targetIndex).join("");
  const writtenSuffix = characters.slice(targetIndex + 1, nextHanIndex).join("");
  const normalizedWordReading = normalizeReading(wordReading, options);
  const normalizedTargetReading = normalizeReading(targetReading, options);
  const localReading = [writtenPrefix, normalizedTargetReading, writtenSuffix]
    .map((part) => normalizeReading(part, options))
    .join("");

  if (!normalizedTargetReading || !localReading) {
    return false;
  }

  if (hanIndexes.length === 1) {
    return normalizedWordReading === localReading;
  }

  if (hanPosition === 0) {
    return normalizedWordReading.startsWith(localReading);
  }

  if (hanPosition === hanIndexes.length - 1) {
    return normalizedWordReading.endsWith(localReading);
  }

  return [...localReading].length >= 2 && normalizedWordReading.includes(localReading);
}

export { normalizeReading, surfaceCarriesReading };
