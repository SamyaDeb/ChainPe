/** ABI fragments for ChainPeAccounts (abi/ChainPeAccounts.json) and the USDC ERC-20 interface. */

export const accountsAbi = [
  {
    type: 'function',
    name: 'proPricePerPeriod',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'planOf',
    inputs: [{ name: 'provider', type: 'address', internalType: 'address' }],
    outputs: [{ name: 'plan', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'subscribe',
    inputs: [{ name: 'periods', type: 'uint8', internalType: 'uint8' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export const usdcAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

/** One subscription period is 30 days. */
export const PERIOD_DAYS = 30
export const MAX_PERIODS = 12
