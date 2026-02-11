"""Mem0 REST API server with environment-driven configuration."""

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from mem0 import Memory


def build_config() -> dict:
    """Build mem0 config from environment variables."""
    provider = os.environ.get("MEM0_VECTOR_STORE_PROVIDER", "qdrant")

    config: dict = {
        "version": "v1.1",
    }

    # Vector store
    if provider == "upstash_vector":
        config["vector_store"] = {
            "provider": "upstash",
            "config": {
                "url": os.environ["UPSTASH_VECTOR_REST_URL"],
                "token": os.environ["UPSTASH_VECTOR_REST_TOKEN"],
            },
        }
    else:
        config["vector_store"] = {
            "provider": "qdrant",
            "config": {
                "host": os.environ.get("QDRANT_HOST", "qdrant"),
                "port": int(os.environ.get("QDRANT_PORT", "6333")),
            },
        }

    # LLM
    llm_model = os.environ.get("MEM0_LLM_MODEL")
    openai_key = os.environ.get("OPENAI_API_KEY")
    openai_base = os.environ.get("OPENAI_BASE_URL")

    if openai_key:
        llm_config: dict = {"provider": "openai", "config": {"api_key": openai_key}}
        if llm_model:
            llm_config["config"]["model"] = llm_model
        if openai_base:
            llm_config["config"]["openai_base_url"] = openai_base
        config["llm"] = llm_config

    # Embedder
    embedder_model = os.environ.get("MEM0_EMBEDDER_MODEL")
    if openai_key:
        embedder_config: dict = {
            "provider": "openai",
            "config": {"api_key": openai_key},
        }
        if embedder_model:
            embedder_config["config"]["model"] = embedder_model
        if openai_base:
            embedder_config["config"]["openai_base_url"] = openai_base
        config["embedder"] = embedder_config

    return config


memory: Optional[Memory] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global memory
    config = build_config()
    memory = Memory.from_config(config)
    yield


app = FastAPI(title="Mem0 Server", lifespan=lifespan)


class AddMemoryRequest(BaseModel):
    messages: list[dict]
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    metadata: Optional[dict] = None


class SearchRequest(BaseModel):
    query: str
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    limit: int = 10


class UpdateMemoryRequest(BaseModel):
    data: str


@app.get("/")
async def root():
    return {"message": "Mem0 Server is running"}


@app.post("/memories")
async def add_memory(req: AddMemoryRequest):
    params = {"messages": req.messages}
    if req.user_id:
        params["user_id"] = req.user_id
    if req.agent_id:
        params["agent_id"] = req.agent_id
    if req.run_id:
        params["run_id"] = req.run_id
    if req.metadata:
        params["metadata"] = req.metadata
    return memory.add(**params)


@app.get("/memories")
async def get_memories(
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
):
    params = {}
    if user_id:
        params["user_id"] = user_id
    if agent_id:
        params["agent_id"] = agent_id
    if run_id:
        params["run_id"] = run_id
    return memory.get_all(**params)


@app.get("/memories/{memory_id}")
async def get_memory(memory_id: str):
    try:
        return memory.get(memory_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.put("/memories/{memory_id}")
async def update_memory(memory_id: str, req: UpdateMemoryRequest):
    try:
        return memory.update(memory_id, data=req.data)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    try:
        memory.delete(memory_id)
        return {"message": "Memory deleted"}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/search")
async def search_memories(req: SearchRequest):
    params = {"query": req.query, "limit": req.limit}
    if req.user_id:
        params["user_id"] = req.user_id
    if req.agent_id:
        params["agent_id"] = req.agent_id
    if req.run_id:
        params["run_id"] = req.run_id
    return memory.search(**params)


@app.delete("/memories")
async def delete_all_memories(
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
):
    params = {}
    if user_id:
        params["user_id"] = user_id
    if agent_id:
        params["agent_id"] = agent_id
    if run_id:
        params["run_id"] = run_id
    memory.delete_all(**params)
    return {"message": "All memories deleted"}


@app.post("/reset")
async def reset():
    memory.reset()
    return {"message": "All memories reset"}
