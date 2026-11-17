#!/bin/sh
set -eu
mkdir -p public
cat source/chunk00.b64 source/chunk01.b64 source/chunk02.b64 source/chunk03.b64 source/chunk04.b64 source/chunk05.b64 source/chunk06a.b64 source/chunk06b.b64 source/chunk06c2.b64 source/chunk06d.b64 source/chunk06e.b64 source/chunk07.b64 source/chunk08.b64 | base64 -d | tar -xz -C public
