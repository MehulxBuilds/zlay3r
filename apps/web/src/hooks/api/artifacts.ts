"use client";
import { z } from "zod";
import { artifactSchema } from "@repo/web/lib/schemas";
import { useApiPages, useApiAction, noContentSchema } from "./core";
export const useArtifacts = () =>
  useApiPages("artifacts", "/v1/artifacts", artifactSchema);
export const useUploadArtifact = () =>
  useApiAction(
    "artifacts",
    async (client, file: File) => {
      z.instanceof(File)
        .refine(
          (value) => value.size <= 8 * 1048576,
          "Choose a file smaller than 8 MB",
        )
        .parse(file);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(z.string().parse(reader.result).split(",")[1]!);
        reader.onerror = () => reject(new Error("Unable to read this file"));
        reader.readAsDataURL(file);
      });
      return client.uploadArtifact({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        data,
      });
    },
    artifactSchema,
    "File uploaded",
  );
export const useDownloadArtifact = () =>
  useApiAction(
    "artifacts",
    (client, id: string) => client.downloadArtifact(id),
    z.object({ url: z.url(), expiresAt: z.string() }),
    "Download link ready",
  );
export const useRemoveArtifact = () =>
  useApiAction(
    "artifacts",
    (client, id: string) => client.removeArtifact(id),
    noContentSchema,
    "Artifact deleted",
  );
