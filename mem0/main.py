"""Mem0 REST API server with environment-driven configuration."""

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from mem0 import Memory
from mem0.vector_stores.upstash_vector import UpstashVector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("mem0-server")

# Monkey-patch: mem0 passes a flat embedding list to search() but the Upstash
# implementation iterates it expecting List[list], yielding individual floats.
# Also works around query_many passing duplicate namespace kwargs.
from mem0.vector_stores.upstash_vector import OutputData


def _patched_search(self, query, vectors, limit=5, filters=None):
    if vectors and not isinstance(vectors[0], list):
        vectors = [vectors]

    filters_str = (
        " AND ".join([f"{k} = {self._stringify(v)}" for k, v in filters.items()])
        if filters
        else None
    )

    if self.enable_embeddings:
        response = self.client.query(
            data=query,
            top_k=limit,
            filter=filters_str or "",
            include_metadata=True,
            namespace=self.collection_name,
        )
    else:
        response = []
        for v in vectors:
            results = self.client.query(
                vector=v,
                top_k=limit,
                filter=filters_str or "",
                include_metadata=True,
                namespace=self.collection_name,
            )
            response.extend(results)

    return [
        OutputData(id=res.id, score=res.score, payload=res.metadata)
        for res in response
    ]


UpstashVector.search = _patched_search


def build_config() -> dict:
    """Build mem0 config from environment variables."""
    provider = os.environ.get("MEM0_VECTOR_STORE_PROVIDER", "qdrant")

    config: dict = {
        "version": "v1.1",
    }

    # Vector store
    if provider == "upstash_vector":
        config["vector_store"] = {
            "provider": "upstash_vector",
            "config": {
                "url": os.environ["UPSTASH_VECTOR_REST_URL"],
                "token": os.environ["UPSTASH_VECTOR_REST_TOKEN"],
                "enable_embeddings": False,
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
    logger.info("Initializing mem0 with config: %s", {k: v for k, v in config.items() if k != "llm" and k != "embedder"})
    memory = Memory.from_config(config)
    logger.info("Mem0 initialized successfully")
    yield


app = FastAPI(title="Mem0 Server", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start) * 1000
    logger.info("%s %s %d %.0fms", request.method, request.url.path, response.status_code, duration_ms)
    return response


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
def add_memory(req: AddMemoryRequest):
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
def get_memories(
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
def get_memory(memory_id: str):
    try:
        return memory.get(memory_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.put("/memories/{memory_id}")
def update_memory(memory_id: str, req: UpdateMemoryRequest):
    try:
        return memory.update(memory_id, data=req.data)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/memories/{memory_id}")
def delete_memory(memory_id: str):
    try:
        memory.delete(memory_id)
        return {"message": "Memory deleted"}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/search")
def search_memories(req: SearchRequest):
    params = {"query": req.query, "limit": req.limit}
    if req.user_id:
        params["user_id"] = req.user_id
    if req.agent_id:
        params["agent_id"] = req.agent_id
    if req.run_id:
        params["run_id"] = req.run_id
    return memory.search(**params)


@app.delete("/memories")
def delete_all_memories(
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
def reset():
    memory.reset()
    return {"message": "All memories reset"}
