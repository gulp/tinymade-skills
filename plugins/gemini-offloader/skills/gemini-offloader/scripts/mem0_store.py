#!/usr/bin/env python3
"""
mem0.ai integration for persistent memory across gemini sessions.
Stores research findings, summaries, and key insights in vector store.

Prerequisites:
    pip install mem0ai

Usage:
    # Check if mem0 is available
    python mem0_store.py status

    # Store a memory from gemini response
    python mem0_store.py add --user "research" --text "Key finding about WASM..."
    python mem0_store.py add --user "research" --text "..." --metadata '{"topic": "wasm", "source": "gemini"}'

    # Search memories
    python mem0_store.py search --user "research" --query "WASM performance"

    # Get all memories for a user/topic
    python mem0_store.py get --user "research"

    # Delete specific memory
    python mem0_store.py delete --id "memory_id_here"

    # Store gemini response directly (reads from stdin or file)
    echo '{"response": "..."}' | python mem0_store.py store-response --user "research" --topic "wasm"

Output JSON:
    {
        "action": "add",
        "success": true,
        "memory_id": "abc123",
        "error": null
    }
"""

import json
import sys
import argparse
import os
from datetime import datetime
from pathlib import Path

# Check if mem0 is available
MEM0_AVAILABLE = False
try:
    from mem0 import Memory
    MEM0_AVAILABLE = True
except ImportError:
    pass


def get_config_path():
    """Get path to mem0 config file."""
    return Path.home() / ".config" / "gemini-offloader" / "mem0_config.json"


def load_config():
    """Load mem0 configuration."""
    config_path = get_config_path()
    if config_path.exists():
        try:
            with open(config_path) as f:
                return json.load(f)
        except:
            pass

    # Default config (uses mem0's defaults - requires OpenAI API key)
    return {
        "version": "v1.1"
        # mem0 will use defaults: OpenAI embeddings, in-memory vector store
        # For production, configure:
        # "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        # "vector_store": {"provider": "qdrant", "config": {"host": "localhost", "port": 6333}},
        # "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}}
    }


def save_config(config):
    """Save mem0 configuration."""
    config_path = get_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def get_memory():
    """Initialize mem0 Memory instance."""
    if not MEM0_AVAILABLE:
        return None, "mem0 not installed. Run: pip install mem0ai"

    config = load_config()
    try:
        m = Memory.from_config(config)
        return m, None
    except Exception as e:
        # Try simple initialization
        try:
            m = Memory()
            return m, None
        except Exception as e2:
            return None, f"Failed to initialize mem0: {e2}"


def cmd_status(args):
    """Check mem0 availability and configuration."""
    result = {
        "action": "status",
        "mem0_installed": MEM0_AVAILABLE,
        "success": MEM0_AVAILABLE
    }

    if not MEM0_AVAILABLE:
        result["error"] = "mem0 not installed. Run: pip install mem0ai"
        result["install_command"] = "pip install mem0ai"
    else:
        m, error = get_memory()
        if error:
            result["success"] = False
            result["error"] = error
        else:
            result["config_path"] = str(get_config_path())
            result["memory_initialized"] = True

    return result


def cmd_add(args):
    """Add a memory."""
    m, error = get_memory()
    if error:
        return {"action": "add", "success": False, "error": error}

    try:
        # Parse metadata if provided
        metadata = {}
        if args.metadata:
            metadata = json.loads(args.metadata)

        # Add timestamp
        metadata["timestamp"] = datetime.now().isoformat()
        metadata["source"] = "gemini-offloader"

        # Add topic if provided
        if args.topic:
            metadata["topic"] = args.topic

        # Add memory
        result = m.add(
            args.text,
            user_id=args.user,
            metadata=metadata
        )

        return {
            "action": "add",
            "success": True,
            "result": result,
            "user": args.user
        }

    except Exception as e:
        return {"action": "add", "success": False, "error": str(e)}


def cmd_search(args):
    """Search memories."""
    m, error = get_memory()
    if error:
        return {"action": "search", "success": False, "error": error}

    try:
        results = m.search(
            query=args.query,
            user_id=args.user,
            limit=args.limit
        )

        return {
            "action": "search",
            "success": True,
            "query": args.query,
            "user": args.user,
            "results": results
        }

    except Exception as e:
        return {"action": "search", "success": False, "error": str(e)}


def cmd_get(args):
    """Get all memories for a user."""
    m, error = get_memory()
    if error:
        return {"action": "get", "success": False, "error": error}

    try:
        results = m.get_all(user_id=args.user)

        return {
            "action": "get",
            "success": True,
            "user": args.user,
            "count": len(results) if results else 0,
            "memories": results
        }

    except Exception as e:
        return {"action": "get", "success": False, "error": str(e)}


def cmd_delete(args):
    """Delete a memory."""
    m, error = get_memory()
    if error:
        return {"action": "delete", "success": False, "error": error}

    try:
        m.delete(memory_id=args.id)

        return {
            "action": "delete",
            "success": True,
            "deleted_id": args.id
        }

    except Exception as e:
        return {"action": "delete", "success": False, "error": str(e)}


def cmd_store_response(args):
    """Store a gemini response as memory."""
    m, error = get_memory()
    if error:
        return {"action": "store-response", "success": False, "error": error}

    try:
        # Read response from stdin or file
        if args.file:
            with open(args.file) as f:
                data = json.load(f)
        elif not sys.stdin.isatty():
            data = json.load(sys.stdin)
        else:
            return {
                "action": "store-response",
                "success": False,
                "error": "No input provided. Pipe JSON or use --file"
            }

        # Extract response text
        response_text = data.get("response") or data.get("text") or str(data)

        # Build metadata
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "source": "gemini-offloader",
            "topic": args.topic,
            "model": data.get("model"),
            "tokens": data.get("tokens")
        }

        # Store as memory
        result = m.add(
            response_text,
            user_id=args.user,
            metadata=metadata
        )

        return {
            "action": "store-response",
            "success": True,
            "result": result,
            "user": args.user,
            "topic": args.topic,
            "text_length": len(response_text)
        }

    except Exception as e:
        return {"action": "store-response", "success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="mem0 vector store integration")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Status command
    subparsers.add_parser("status", help="Check mem0 availability")

    # Add command
    add_parser = subparsers.add_parser("add", help="Add a memory")
    add_parser.add_argument("--user", "-u", required=True, help="User/agent ID")
    add_parser.add_argument("--text", "-t", required=True, help="Text to store")
    add_parser.add_argument("--topic", help="Topic tag")
    add_parser.add_argument("--metadata", "-m", help="JSON metadata")

    # Search command
    search_parser = subparsers.add_parser("search", help="Search memories")
    search_parser.add_argument("--user", "-u", required=True, help="User/agent ID")
    search_parser.add_argument("--query", "-q", required=True, help="Search query")
    search_parser.add_argument("--limit", "-l", type=int, default=5, help="Max results")

    # Get command
    get_parser = subparsers.add_parser("get", help="Get all memories")
    get_parser.add_argument("--user", "-u", required=True, help="User/agent ID")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a memory")
    delete_parser.add_argument("--id", required=True, help="Memory ID to delete")

    # Store-response command
    store_parser = subparsers.add_parser("store-response", help="Store gemini response")
    store_parser.add_argument("--user", "-u", required=True, help="User/agent ID")
    store_parser.add_argument("--topic", required=True, help="Topic for the response")
    store_parser.add_argument("--file", "-f", help="Read response from file")

    args = parser.parse_args()

    handlers = {
        "status": cmd_status,
        "add": cmd_add,
        "search": cmd_search,
        "get": cmd_get,
        "delete": cmd_delete,
        "store-response": cmd_store_response
    }

    result = handlers[args.command](args)
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
