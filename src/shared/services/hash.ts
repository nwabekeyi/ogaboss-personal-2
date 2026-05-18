import bcrypt from "bcrypt";

export function hash(str: string, salt: string | number = 12) {
    return bcrypt.hash(str, salt);
}

export function compareHash(str: string, hash: string) {
    return bcrypt.compare(str, hash);
}
