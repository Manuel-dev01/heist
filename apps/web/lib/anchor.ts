/** HEIST runs-v1 on-chain anchor: one Kite TESTNET transaction committing to all 5,383 live records (two-level heist-sha256-ordered-v1 Merkle tree). */
export const ANCHOR = {
  "network": "Kite testnet",
  "chainId": 2368,
  "rpc": "https://rpc-testnet.gokite.ai/",
  "txHash": "0x395577374ec313e0de97436181be4c39da317a15406efd8b570a49ab89492102",
  "blockNumber": 22044909,
  "from": "0xaAf5cC897480049b9048B5eA6D2Cd1689C326883",
  "explorer": "https://testnet.kitescan.ai/tx/0x395577374ec313e0de97436181be4c39da317a15406efd8b570a49ab89492102",
  "anchoredAt": "2026-11-15T18:33:43.670Z",
  "algorithm": "heist-sha256-ordered-v1",
  "topRoot": "1757b04ec480547490b42bff4dcdbe5df27bd320a96d71e8dc9555cfad842560",
  "runs": [
    {
      "id": "D2",
      "leafCount": 1040,
      "rootHash": "47193ce6fde7fa79034b4a7da91513fae534ae12405f480e451567f68d271964"
    },
    {
      "id": "D3",
      "leafCount": 3780,
      "rootHash": "27354a9b44179ed4436f8536fa8929a8870e271eaeb154b8218f4a5eaf660f2e"
    },
    {
      "id": "REF-v5",
      "leafCount": 331,
      "rootHash": "a56e7243ca7cd8b4a711befea33614f94b70fd6e45388939195132c38cd8ee91"
    },
    {
      "id": "REF-v6",
      "leafCount": 232,
      "rootHash": "f2281e28fba8a4c574b22815c4682b5c855fb9744329d28577e76287267efd66"
    }
  ]
} as const;
