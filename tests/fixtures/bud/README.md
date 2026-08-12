# Pinned Hashtree vectors

These vectors are copied verbatim from the proposal documents at the exact revisions adopted on 2026-08-12:

- BUD-16 directory manifests: https://github.com/hzrd149/blossom/blob/1b2f140b0d3fd06a907b159d7628e1d007588da3/buds/16.md
- BUD-17 chunk/fanout manifests: https://github.com/hzrd149/blossom/blob/1848f77c4a25b70d10a3963d66ba1c8aba1e4f2c/buds/17.md
- BUD-18 immutable references: https://github.com/hzrd149/blossom/blob/018f3e32227cf8fd1fba8dff2d39d6e3370d2d52/buds/18.md

`tests/protocol/hashtree_test.ts` embeds the published MessagePack hex for BUD-16's single-file directory and BUD-17's two-chunk file. Changing these revisions or vectors is a visible protocol compatibility decision, not a fixture refresh.
