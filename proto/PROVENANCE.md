# Vendored protos

`supervisor_middleware.proto` and `extension.proto` are copied verbatim from
NVIDIA/OpenShell at commit `ba16b9f2c7c59899532628ffa6cd26d37bffd477`, paths
`proto/supervisor_middleware.proto` and `proto/extension.proto`. Apache-2.0,
SPDX headers preserved in the files.

Verify with:

    shasum -a 256 proto/supervisor_middleware.proto proto/extension.proto

against the same files in a fresh OpenShell checkout at that commit.
