/** MAPS frmProtectProject: both fields have MaxLength = 8. */
export const PROJECT_PASSWORD_MAX_LENGTH = 8;
export const PROJECT_PASSWORD_INPUT_HINT = "Use 1–8 printable ASCII characters (letters, numbers, spaces or symbols).";

/** MAPS TypeUtils.CheckPasswordIntegrity / IsASCII: no length or strength gate. */
export function isDeployPasswordValid(password: string): boolean {
  return password.length > 0 && [...password].every((char) => char.charCodeAt(0) <= 0x7f);
}

/** MAPS frmProtectProject uses StringIsASCII (space through ~), not IsASCII. */
export function isNewProjectPasswordValid(password: string): boolean {
  return password.length > 0 && password.length <= PROJECT_PASSWORD_MAX_LENGTH &&
    [...password].every((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) <= 0x7e);
}
