# PA Imaging TCP Stream Design

## Goal

Integrate the existing PA imaging user-space capture flow from
`axis-capture-app.c` into the Butterfly Laser Driver server, but move the
captured data to the upper computer over a stable TCP connection instead of
storing it on the board.

The first version stores the raw captured stream on the Tauri side and reports
progress. It does not reconstruct or display the PA image in real time.

## Existing Flow To Preserve

The current PA capture app performs these hardware operations:

1. Program the PAM image acquisition AXI-Lite register bank at `0xA0110000`.
2. Force PAM `start=0`.
3. Open `/dev/axis_capture0`.
4. Query the `axis-capture-superblock` driver status with
   `AXIS_CAP_IOC_GET_STATUS`.
5. Start DMA with `AXIS_CAP_IOC_START`.
6. Set PAM `start=1`.
7. Poll and read superblocks from `/dev/axis_capture0`.
8. Stop by setting PAM `start=0`, then sending `AXIS_CAP_IOC_STOP`.
9. Drain ready or partial superblocks until the driver returns EOF.

The server implementation must keep this ordering. It is part of the hardware
contract, not just application structure.

## Architecture

The existing HTTP JSON/SSE server remains the control plane. It gains PA
capture endpoints for configuration, start, stop, and status. A separate TCP
listener on the board is the data plane. The Tauri application connects to this
TCP listener before starting capture, receives the stream, and saves it on the
upper computer.

The board remains the TCP server because it owns the capture hardware and this
avoids requiring the board to discover the PC address. Tauri acts as the TCP
client because it owns user file selection and saving.

Only one PA data client and one PA capture session are allowed at a time. If the
TCP client disconnects during capture, the server stops the hardware using the
same safe stop sequence.

## Server Components

### PA Capture Core

Add a focused PA capture module to the Python server code. It will provide:

- `PamCaptureParams`: typed register values matching `axis-capture-app.c`.
- `AxisCaptureStatus`: driver status fields from `axis-capture-superblock.c`.
- `AxisBlockHeader`: driver block header fields.
- `PamAxiController`: writes and verifies the `0xA0110000` PAM registers.
- `AxisCaptureDevice`: wraps `/dev/axis_capture0`, ioctl, poll, and read.
- `PaCaptureWorker`: owns one acquisition thread and the stop/drain sequence.
- `PaTcpStreamServer`: owns the TCP listener and the connected client socket.

The module can reuse the existing `AxiMap` helper from
`butterfly_laser_control.py` for `/dev/mem` access.

### HTTP API

Add these endpoints to the existing server handler:

- `GET /api/pa/status`
  Returns connection state, running state, latest driver counters, active
  capture parameters, bytes sent, blocks sent, frames sent, transfer rate, and
  last error.

- `POST /api/pa/start`
  Body includes PAM register parameters and capture limits. Start fails if no
  TCP client is connected, if a capture is already running, or if another
  hardware operation has the server lock.

- `POST /api/pa/stop`
  Requests a graceful stop. The worker sets PAM `start=0`, sends DMA STOP, then
  drains remaining superblocks.

- `POST /api/pa/disconnect`
  Closes the PA data socket if idle. If capture is running, it first requests
  stop.

`/api/status` should include a compact `pa` object so the Tauri status polling
and SSE stream can show PA state without a separate polling loop.

## TCP Stream Protocol

The TCP stream is record-based. TCP packet boundaries are ignored; Tauri reads
exactly the declared number of bytes for each record.

All integer fields are little-endian. Each record begins with:

```text
magic[4]       = "PAI1"
version_u16    = 1
record_type_u16
header_bytes_u32
payload_bytes_u64
sequence_u64
timestamp_ns_u64
block_id_u64
frame_count_u32
reserved_u32
first_frame_id_u64
last_frame_id_u64
```

Record types:

- `1`: session metadata JSON. Payload is UTF-8 JSON with capture parameters,
  driver status, stream format, and software versions.
- `2`: data block. Payload is the raw bytes read from `/dev/axis_capture0`
  after the driver block header. Block metadata is carried in the TCP record
  header.
- `3`: status JSON. Payload is UTF-8 JSON with cumulative counters.
- `4`: end JSON. Payload is UTF-8 JSON with final counters and end reason.
- `5`: error JSON. Payload is UTF-8 JSON with the error message and counters.

This protocol keeps the large binary payload raw, but gives Tauri enough
metadata to validate ordering, detect truncation, and reconstruct the original
superblock sequence.

## Tauri Components

### Rust Side

Add Tauri commands for PA capture receiving:

- `pa_connect_and_prepare(board_host, tcp_port, output_path, expected_session)`
  Connects to the board TCP listener, creates the output file, and starts a
  background receiver thread.

- `pa_receiver_status()`
  Returns connected/running state, bytes received, blocks received, frames
  received, rate, output path, and last error.

- `pa_receiver_stop()`
  Closes the socket and finalizes the file.

The receiver writes a file format that begins with a small Tauri-side file
header, then appends the exact PA stream records. This keeps saving cheap and
makes later processing deterministic.

### React Side

Add a PA imaging panel or tab with:

- Connection state for PA TCP.
- PAM parameter inputs matching the existing app keys.
- Capture limits: capture time seconds and max blocks.
- Output file selection or generated default path under `Data/PA Imaging`.
- Start, stop, disconnect controls.
- Progress fields: bytes, blocks, frames, MB/s, elapsed time, and last error.

The first version should not push data blocks into React state.

## Error Handling

- If no TCP client is connected, `/api/pa/start` returns HTTP 409 and does not
  touch hardware.
- If register readback fails, the worker aborts before starting DMA.
- If TCP send fails during capture, the worker requests hardware stop and
  drains or closes according to the driver state.
- If the Tauri receiver fails to write the output file, it closes the socket so
  the board can stop safely.
- Stop is idempotent. Multiple stop requests do not send conflicting hardware
  operations.
- Any failure path that has asserted PAM start must force PAM `start=0`.
- Any failure path that has started DMA must send `AXIS_CAP_IOC_STOP`.

## Testing Strategy

Server tests use fakes for AXI, ioctl, poll, read, and sockets. They verify:

- PAM register packing and readback rules.
- Driver status and block header parsing.
- Start order: program registers, DMA START, PAM start high.
- Stop order: PAM start low, DMA STOP, drain until EOF.
- TCP record framing for metadata, data, status, end, and error records.
- Disconnect during capture stops hardware and records an error.

Tauri Rust tests cover record parsing and file writing with in-memory or temp
files. React tests cover the PA panel controls and state display without real
network access.

Manual board validation uses a short capture with a connected Tauri receiver
and checks that final counters match the server status and output file size.

## Out Of Scope For First Version

- Real-time PA image reconstruction.
- Real-time PA image display.
- Multiple simultaneous TCP clients.
- Authentication or encryption on the lab network.
- Changes to the kernel driver ABI.
