import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CacheClient, CacheListFetchResponse, CacheListConcatenateBackResponse } from '@gomomento/sdk';

const bedrock = new BedrockRuntimeClient();
const cacheClient = new CacheClient({ defaultTtlSeconds: 300 }); // Gets credentials from process.env.MOMENTO_API_KEY

/**
 * Prompt an LLM. Can be used for one-shot queries or conversations. Uses Momento Cache to retain message history automatically.
 * You must set the `MOMENTO_API_KEY` and `CACHE_NAME` environment variables for conversation history to be kept.
 * The LLM model can be set by configuring the `MODEL_ID` environment variable.
 *
 * *Requires the `bedrock:InvokeModel` IAM permission.*
 *
 * @param {Object} params
 * @param {string} props.message - REQUIRED! The message to send to the LLM
 * @param {string} [props.chatId] - A unique identifier for the conversation. Conversation history will be recorded if this is provided
 * @param {string} [props.systemMessage] - Used to position the LLM for answering a specific way
 * @returns {string} Text response from the LLM
 *
 * @example
 * const response = await chat({ message: 'What is the capital of France?' });
 *
 * @example
 * const response = await chat({ chatId: 'abc', message: 'Then what happened?'});
 */
export const chat = async (params) => {
  let messages = [];

  // Load conversation history, if it exists
  if (params.chatId) {
    const historyResponse = await cacheClient.listFetch(process.env.CACHE_NAME, params.chatId);
    switch (historyResponse.type) {
      case CacheListFetchResponse.Hit:
        messages = historyResponse.valueListString().map(JSON.parse);
        break;
      case CacheListFetchResponse.Error:
        console.error(historyResponse.toString());
    }
  }

  // Add the new message to the conversation
  const newMessage = { role: 'user', content: [{ type: 'text', text: params.message }] };
  messages.push(newMessage);

  const response = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      max_tokens: 10000,
      anthropic_version: "bedrock-2023-05-31",
      messages,
      ...params.systemMessage && { system: params.systemMessage }
    })
  }));

  const answer = JSON.parse(new TextDecoder().decode(response.body));
  const modelResponse = answer.content[0].text;

  // Save new messages to conversation history, if applicable
  if(params.chatId){
    const newChatMessages = [JSON.stringify(newMessage), JSON.stringify({role: 'assistant', content: answer.content})];
    const updateHistoryResponse = await cacheClient.listConcatenateBack(process.env.CACHE_NAME, params.chatId, newChatMessages);
    switch(updateHistoryResponse.type){
      case CacheListConcatenateBackResponse.Error:
        console.error(updateHistoryResponse.toString());
    }
  }

  return modelResponse;
};
