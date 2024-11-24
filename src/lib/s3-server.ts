import { S3 } from "@aws-sdk/client-s3";
import fs from "fs";

export async function downloadFromS3(file_key: string): Promise<string | null> {
  return new Promise(async (resolve, reject) => {
    try {
      const s3 = new S3({
        region: "us-east-1",
        credentials: {
          accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY!,
        },
      });

      // The key params is no longer supported in v3, and can be removed.
      // @deprecated The object needs to be passed to individual operations where it's intended.

      const params = {
        Bucket: process.env.NEXT_PUBLIC_AWS_BUCKET_NAME!,
        Key: file_key,
      };

      console.log("Attempting to download with filekey:", file_key);
      const obj = await s3.getObject(params);
      const file_name = `/tmp/pdf-${Date.now()}.pdf`;

      if (obj.Body instanceof require("stream").Readable) {
        // AWS-SDK v3 has some issues with their typescript definitions, but this works
        // https://github.com/aws/aws-sdk-js-v3/issues/843
        //open the writable stream and write the file
        const file = fs.createWriteStream(file_name);
        file.on("open", function (fd) {
          // @ts-ignore
          obj.Body?.pipe(file).on("finish", () => {
            return resolve(file_name);
          });
        });
      }

      // fs.writeFileSync(file_name, obj.Body as Buffer);
      // return file_name;
    } catch (error) {
      console.error(error);
      return null;
    }
  });
}
