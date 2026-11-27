import net, { type Socket } from "node:net";

/** Firecracker's host AF_UNIX → guest AF_VSOCK handshake. */
export function connectGuest(
  socketPath: string,
  kind: string,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(
      () => socket.destroy(new Error("GUEST_CONNECT_TIMEOUT")),
      5000,
    );
    let buffered = Buffer.alloc(0);
    let stage = 0;
    const receive = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > 65536) {
        socket.destroy(new Error("GUEST_HANDSHAKE_LIMIT"));
        return;
      }
      const index = buffered.indexOf(10);
      if (index < 0) return;
      const line = buffered.subarray(0, index).toString();
      buffered = buffered.subarray(index + 1);
      if (stage === 0 && /^OK \d+$/.test(line)) {
        stage = 1;
        socket.write(JSON.stringify({ kind }) + "\n");
      } else if (stage === 1 && line === "OK") {
        clearTimeout(timer);
        socket.removeListener("data", receive);
        socket.pause();
        if (buffered.length) socket.unshift(buffered);
        resolve(socket);
      } else socket.destroy(new Error("GUEST_HANDSHAKE_REJECTED"));
    };
    socket.on("data", receive);
    socket.once("connect", () => socket.write("CONNECT 52\n"));
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timer);
      reject(new Error("GUEST_CONNECTION_CLOSED"));
    });
  });
}
