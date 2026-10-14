import { isIP } from 'node:net';

function ipToBigInt(ip: string): { bits: 32 | 128; value: bigint } | null {
  const version = isIP(ip);
  if (version === 4) {
    return { bits: 32, value: ip.split('.').reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n) };
  }
  if (version !== 6) return null;
  let input = ip.toLowerCase();
  const ipv4Match = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const bytes = ipv4Match[1].split('.').map(Number);
    input = input.replace(
      ipv4Match[0],
      `:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`,
    );
  }
  const split = input.split('::');
  const left = split[0] ? split[0].split(':') : [];
  const right = split[1] ? split[1].split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return {
    bits: 128,
    value: groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group || '0', 16)), 0n),
  };
}

export function validateIpAllow(rules: string): boolean {
  return rules.split(',').every((rawRule) => {
    const parts = rawRule.trim().split('/');
    if (parts.length > 2) return false;
    const [address, rawPrefix] = parts;
    const parsed = ipToBigInt(address);
    if (!parsed) return false;
    if (rawPrefix === undefined) return true;
    if (!/^\d+$/.test(rawPrefix)) return false;
    const prefix = Number(rawPrefix);
    return Number.isInteger(prefix) && prefix >= 0 && prefix <= parsed.bits;
  });
}

export function isIpAllowed(ip: string, rules: string | null): boolean {
  if (!rules?.trim()) return true;
  const address = ipToBigInt(ip);
  if (!address) return false;
  return rules.split(',').some((rawRule) => {
    const parts = rawRule.trim().split('/');
    if (parts.length > 2) return false;
    const [network, rawPrefix] = parts;
    const parsed = ipToBigInt(network);
    if (!parsed || parsed.bits !== address.bits) return false;
    if (rawPrefix === undefined) return parsed.value === address.value;
    if (!/^\d+$/.test(rawPrefix)) return false;
    const prefix = Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) return false;
    const shift = BigInt(parsed.bits - prefix);
    return (parsed.value >> shift) === (address.value >> shift);
  });
}
