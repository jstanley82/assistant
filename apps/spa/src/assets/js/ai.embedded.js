import { Body, Controller, Post, Get, Param } from '@nestjs/common';
import { AssistantService } from '@boldare/openai-assistant';
import { AssistantResponse } from 'ai';
import OpenAI from 'openai';
import { UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

interface ChatRequest {
  threadId: string | null;
  message: string;
  fileIds: string[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '', // Make sure this is set
});

const ASSISTANT_ID = 'asst_yfDd5bAoT20HJv5WepJSr2VC'; // Your assistant ID
const VECTOR_STORE_ID = 'vs_qBlCyWxoAp5KlBSeLGUaEg0Y'; // Your vector store ID

@Controller('assistant')
export class AssistantController {
  // Store the current thread and run IDs
  private currentThreadId: string | null = null;
  private currentRunId: string | null = null;

  constructor(private readonly assistantService: AssistantService) {}

  @Post()
  async handleAssistantRequest(@Body() input: ChatRequest): Promise<Response> {
    try {
      let threadId = input.threadId;
      if (!threadId) {
        const newThread = await this.assistantService.threads.createThread();
        threadId = newThread.id;
        this.currentThreadId = threadId; // Store the new thread ID
      }

      // Add user message to thread (including file IDs if needed)
      await this.assistantService.threads.messages.create(threadId, {
        role: 'user',
        content: input.message,
        // ... (Add file IDs to attachments if needed)
      });

      return AssistantResponse(
        { threadId },
        async ({ forwardStream, sendDataMessage }) => {
          const runStream = this.assistantService.threads.runs.stream(
            threadId,
            {
              assistant_id: ASSISTANT_ID,
            },
          );

          let runResult = await forwardStream(runStream);
          this.currentRunId = runResult.id; // Store the run ID

          while (
            runResult?.status === 'requires_action' &&
            runResult.required_action?.type === 'submit_tool_outputs'
          ) {
            const toolOutputs = runResult.required_action.submit_tool_outputs.tool_calls.map(
              (toolCall) => {
                const parameters = JSON.parse(toolCall.function.arguments);

                switch (toolCall.function.name) {
                  case 'SearchVectorStore':
                    // Call OpenAI to search the vector store
                    const searchResults = await openai.beta.vectorStores.search(
                      VECTOR_STORE_ID,
                      parameters.query,
                    );
                    return {
                      tool_call_id: toolCall.id,
                      output: JSON.stringify(searchResults.results),
                    };
                  // Add cases for other tools
                  default:
                    throw new Error(
                      `Unknown tool call function: ${toolCall.function.name}`,
                    );
                }
              },
            );

            runResult = await forwardStream(
              this.assistantService.threads.runs.submitToolOutputsStream(
                threadId,
                runResult.id, // Use the stored run ID
                { tool_outputs: toolOutputs },
              ),
            );
          }
        },
      ).toAIStreamResponse();
    } catch (err) {
      console.error('Backend Error:', err);
      throw err;
    }
  }

  // Route to handle file retrieval
  @Get('files/retrieve/:fileId')
  async retrieveFile(@Param('fileId') fileId: string) {
    try {
      const file = await this.assistantService.files.retriveFile(fileId);
      return file;
    } catch (err) {
      console.error('Backend File Retrieval Error:', err);
      throw err;
    }
  }

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, { // Allow up to 10 files
      storage: diskStorage({
        destination: './uploads', // Temporary storage location
        filename: (req, file, cb) => {
          // Generate a unique filename
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
        },
      }),
    }),
  )
  async uploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
    try {
      const uploadedFiles = await Promise.all(
        files.map(async (file) => {
          const openaiFile = await openai.files.create({
            file: file.path, // Path to the temporarily stored file
            purpose: 'assistants',
          });
          return openaiFile;
        }),
      );

      // ... (Optional: Delete the temporary files from './uploads')

      return { files: uploadedFiles };
    } catch (err) {
      console.error('Backend File Upload Error:', err);
      throw err;
    }
  }
}

