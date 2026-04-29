CREATE TYPE "AdapterArtifactFormat" AS ENUM ('GGUF', 'PEFT');
CREATE TYPE "AdapterRuntime" AS ENUM ('LLAMA_CPP', 'TRANSFORMERS');

ALTER TABLE "Adapter"
ADD COLUMN "format" "AdapterArtifactFormat" NOT NULL DEFAULT 'GGUF',
ADD COLUMN "runtime" "AdapterRuntime" NOT NULL DEFAULT 'LLAMA_CPP',
ADD COLUMN "baseModel" TEXT,
ADD COLUMN "storagePath" TEXT;
