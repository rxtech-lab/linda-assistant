import { generateText, tool } from "ai";
import { z } from "zod";
import { uploadBufferToS3 } from "../../s3";
import { IMAGE_GENERATION_MODEL } from "../context";

export const generateImageTool = () =>
  tool({
    description:
      "Generate an AI image and upload it to storage. Use this to create illustrations, diagrams, or visual aids " +
      "that help explain complex topics in documents or briefings. Returns the image URL that can be embedded " +
      "in markdown content via ![alt](url). Do NOT use this for charts or data visualizations — use create_drawing instead.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "Detailed description of the image to generate. Be specific about style, composition, and content.",
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "Optional filename hint (without extension). Defaults to a timestamp-based name.",
        ),
    }),
    execute: async ({ prompt, filename }) => {
      // In E2E mode, skip actual generation and return a test image
      if (process.env.IS_E2E?.toLowerCase() === "true") {
        const testPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
          "base64",
        );
        const { url } = await uploadBufferToS3(
          testPng,
          "image/png",
          `${filename || "image"}-${Date.now()}.png`,
          "generated-images",
        );
        return { url };
      }

      const result = await generateText({
        model: IMAGE_GENERATION_MODEL,
        providerOptions: {
          google: { responseModalities: ["TEXT", "IMAGE"] },
        },
        prompt,
      });

      if (!result.files || result.files.length === 0) {
        throw new Error("Image generation did not produce any files");
      }

      const file = result.files[0];
      const buffer = Buffer.from(file.base64, "base64");
      const ext = file.mediaType === "image/png" ? "png" : "jpg";
      const finalName = `${filename || "image"}-${Date.now()}.${ext}`;
      const { url } = await uploadBufferToS3(buffer, file.mediaType, finalName, "generated-images");

      return { url };
    },
  });

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";
