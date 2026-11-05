"""A local model served by Ollama, for the agents in this folder instead of an OpenAI model.

Ollama exposes an OpenAI-compatible API on this machine, so there is no key and no cost.
Start Ollama and run `ollama pull qwen2.5-coder:32b` once, then `from local_llm import local_model`.
"""

import json
import re
import uuid

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageFunctionToolCall
from openai.types.chat.chat_completion_message_function_tool_call import Function
from agents import OpenAIChatCompletionsModel, custom_span

MODEL_NAME = "qwen2.5-coder:32b"
OLLAMA_BASE_URL = "http://localhost:11434/v1"

# qwen2.5-coder sometimes writes a tool call as JSON text, alone or after a sentence, instead of a
# real tool call, so the SDK treats it as the final answer. This finds that JSON and turns it into
# a proper tool call.
decoder = json.JSONDecoder()


def find_tool_call(text, tool_names):
    for match in re.finditer(r"\{", text):
        try:
            call, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        if isinstance(call, dict) and call.get("name") in tool_names and isinstance(call.get("arguments"), dict):
            return call
    return None


def recover_tool_call(message, tool_names):
    if message.tool_calls or not message.content:
        return False
    call = find_tool_call(message.content, tool_names)
    if call is None:
        return False
    message.tool_calls = [
        ChatCompletionMessageFunctionToolCall(
            id=f"call_{uuid.uuid4().hex[:8]}",
            type="function",
            function=Function(name=call["name"], arguments=json.dumps(call["arguments"])),
        )
    ]
    message.content = None
    return True


ollama_client = AsyncOpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")
_create = ollama_client.chat.completions.create


async def create_with_tool_recovery(*args, **kwargs):
    response = await _create(*args, **kwargs)
    if kwargs.get("stream"):
        return response
    tool_names = {t["function"]["name"] for t in kwargs.get("tools") or [] if isinstance(t, dict) and "function" in t}
    for choice in response.choices:
        if recover_tool_call(choice.message, tool_names):
            choice.finish_reason = "tool_calls"
            # Make each recovery visible in the saved trace (D16), as an SDK custom span.
            with custom_span("tool_call_recovered", data={"tool": choice.message.tool_calls[0].function.name}):
                pass
    return response


ollama_client.chat.completions.create = create_with_tool_recovery
local_model = OpenAIChatCompletionsModel(model=MODEL_NAME, openai_client=ollama_client)
