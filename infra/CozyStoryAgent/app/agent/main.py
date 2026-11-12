import json
import os

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "openai.gpt-oss-120b-1:0")
REASONING_EFFORT = "low"
MAX_OUTPUT_TOKENS = 2048
bedrock = boto3.client("bedrock-runtime")


@app.entrypoint
def invoke(payload, context):
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Request must include a non-empty messages array.")

    system_parts = [
        message["content"]
        for message in messages
        if isinstance(message, dict)
        and message.get("role") == "system"
        and isinstance(message.get("content"), str)
    ]
    schema = payload.get("jsonSchema")
    if schema is not None:
        system_parts.append(
            "Return a JSON object matching this JSON Schema exactly:\n"
            + json.dumps(schema, separators=(",", ":"))
        )
    conversation = [
        {
            "role": message["role"],
            "content": [{"text": message["content"]}],
        }
        for message in messages
        if isinstance(message, dict)
        and message.get("role") in ("user", "assistant")
        and isinstance(message.get("content"), str)
    ]
    if not conversation or conversation[-1]["role"] != "user":
        raise ValueError("Request must end with a user message.")

    max_tokens = payload.get("maxTokens", 700)
    if not isinstance(max_tokens, int) or isinstance(max_tokens, bool):
        raise ValueError("maxTokens must be an integer.")
    max_tokens = min(max(max_tokens, 1), MAX_OUTPUT_TOKENS)
    temperature = payload.get("temperature", 0.7)
    if not isinstance(temperature, (int, float)) or isinstance(temperature, bool):
        raise ValueError("temperature must be numeric.")
    temperature = min(max(float(temperature), 0.0), 1.0)

    response = bedrock.converse(
        modelId=MODEL_ID,
        system=[{"text": part} for part in system_parts],
        messages=conversation,
        inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
        additionalModelRequestFields={"reasoning_effort": REASONING_EFFORT},
    )
    text = "".join(
        block["text"]
        for block in response["output"]["message"]["content"]
        if "text" in block
    )
    if not text:
        raise RuntimeError("The Bedrock model returned no text.")
    return {"text": text}


if __name__ == "__main__":
    app.run()
