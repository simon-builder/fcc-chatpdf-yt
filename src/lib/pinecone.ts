import { Pinecone, PineconeRecord } from "@pinecone-database/pinecone";
import { downloadFromS3 } from "./s3-server";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import md5 from "md5";
import {
  Document,
  RecursiveCharacterTextSplitter,
} from "@pinecone-database/doc-splitter";
import { getEmbeddings } from "./embeddings";
import { convertToAscii } from "./utils";

// Pinecone client singleton
let pinecone: Pinecone | null = null;

// Initialize Pinecone vector DB client
export const getPineconeClient = () => {
  return new Pinecone({
    apiKey: process.env.PINECONE_KEY!, // API key from env vars
  });
};

// Type definition for PDF page structure
type PDFPage = {
  pageContent: string; // Raw text content
  metadata: {
    loc: { pageNumber: number }; // Page location metadata
  };
};

// Main function to process PDF and store in Pinecone
export async function loadS3IntoPinecone(filekey: string) {
  // Step 1: Get PDF from S3
  console.log("downloading from s3 into file system");
  const file_name = await downloadFromS3(filekey);
  if (!file_name) {
    throw new Error("could not download from s3");
  }

  // Step 2: Load PDF content
  console.log("loading pdf into memory" + file_name);
  const loader = new PDFLoader(file_name);
  const pages = (await loader.load()) as PDFPage[];

  // Step 3: Split PDF into segments
  console.log("splitting and segmenting pdf");
  const documents = await Promise.all(pages.map(prepareDocument));

  // 3. vectorise and embed individual documents
  console.log("vectorise and embed individual documents");
  const vectors = await Promise.all(documents.flat().map(embedDocument));

  // 4. upload to pinecone
  console.log("uploading to pinecone");
  const client = getPineconeClient();
  const pineconeIndex = client.index("fcc-chatpdf-yt");
  const namespace = pineconeIndex.namespace(convertToAscii(filekey));

  console.log("inserting vectors into pinecone");
  await namespace.upsert(vectors);

  return documents[0];
}

// Embed document content and create Pinecone record
async function embedDocument(doc: Document) {
  try {
    // Get OpenAI embeddings for document content
    const embeddings = await getEmbeddings(doc.pageContent);
    // Create unique hash ID from content
    const hash = md5(doc.pageContent);

    // Return formatted Pinecone record
    return {
      id: hash,
      values: embeddings, // Vector embeddings
      metadata: {
        text: doc.metadata.text,
        pageNumber: doc.metadata.pageNumber,
      },
    } as PineconeRecord;
  } catch (error) {
    console.log("error embedding document", error);
    throw error;
  }
}

// Utility to truncate string to specific byte length
export const truncateStringByBytes = (str: string, bytes: number) => {
  const enc = new TextEncoder();
  return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
};

// Prepare PDF page for embedding
async function prepareDocument(page: PDFPage) {
  // Extract content and metadata
  let { pageContent, metadata } = page;
  // Remove newlines
  pageContent = pageContent.replace(/\n/g, "");
  
  // Initialize text splitter
  const splitter = new RecursiveCharacterTextSplitter();
  
  // Split into smaller documents
  const docs = await splitter.splitDocuments([
    new Document({
      pageContent,
      metadata: {
        pageNumber: metadata.loc.pageNumber,
        // Truncate text to 36KB limit
        text: truncateStringByBytes(pageContent, 36000),
      },
    }),
  ]);
  return docs;
}
