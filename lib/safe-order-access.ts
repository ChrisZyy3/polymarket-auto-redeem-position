import { encodeAbiParameters, getAddress, getCreate2Address, keccak256, verifyMessage } from "viem";

const safeFactory = "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b";
const safeInitCodeHash = "0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf";
const address = /^0x[a-fA-F0-9]{40}$/;
export type AccessRequest = { signer: string; funder: string; origin: string; issuedAt: number; nonce: string; signature: string };

export function safeAddressForSigner(signer: `0x${string}`) {
  const salt = keccak256(encodeAbiParameters([{type:"address"}], [getAddress(signer)]));
  return getCreate2Address({ from:safeFactory, salt, bytecodeHash:safeInitCodeHash });
}
export function orderAccessMessage(input: Pick<AccessRequest, "signer" | "funder" | "origin" | "issuedAt" | "nonce">) {
  return `Polymarket Dashboard - Read open orders\nSigner: ${input.signer.toLowerCase()}\nSafe: ${input.funder.toLowerCase()}\nSite: ${input.origin}\nIssued at: ${input.issuedAt}\nNonce: ${input.nonce}\nThis only authorizes reading open orders, not trading.`;
}
export async function verifyOrderAccess(input: AccessRequest, nowMs=Date.now()) {
  if (!input || typeof input.origin !== "string" || input.origin.length > 256 || !address.test(input.signer) || !address.test(input.funder) || !Number.isSafeInteger(input.issuedAt) ||
      Math.abs(nowMs - input.issuedAt) > 120000 || !/^[a-f0-9]{32}$/.test(input.nonce) || !/^0x[a-fA-F0-9]{130}$/.test(input.signature)) return false;
  if (safeAddressForSigner(input.signer as `0x${string}`).toLowerCase() !== input.funder.toLowerCase()) return false;
  try { return await verifyMessage({ address: input.signer as `0x${string}`, message: orderAccessMessage(input), signature: input.signature as `0x${string}` }); }
  catch { return false; }
}
