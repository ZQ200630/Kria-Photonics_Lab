# Board Payload

This directory contains the files uploaded by `../upload_pl.sh` to the target
board.

Files:

```text
design_top.bin
pl.dtbo
axis-capture-superblock.ko
reset_all.sh
```

`reset_all.sh` expects these files to be in the same directory on the target
board. The upload script copies them together with the Python server files.
