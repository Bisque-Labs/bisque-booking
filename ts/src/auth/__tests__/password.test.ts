import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies correctly", async () => {
    const plain = "correct-horse-battery-staple";
    const hashed = await hashPassword(plain);
    expect(hashed).not.toBe(plain);
    expect(hashed).toMatch(/^\$2[ab]\$/);
    await expect(verifyPassword(plain, hashed)).resolves.toBe(true);
  });

  it("rejects wrong password", async () => {
    const hashed = await hashPassword("secret");
    await expect(verifyPassword("wrong", hashed)).resolves.toBe(false);
  });

  it("produces different hashes for same input (bcrypt salting)", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});
