/**
 * Model Context Protocol (MCP) JSON-RPC 2.0 Specifications
 * Compatible with Claude Desktop, Cursor, and official @modelcontextprotocol/sdk clients.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: any;
  error?: MCPErrorEnvelope;
}

export interface MCPErrorEnvelope {
  code: number;
  message: string;
  data?: {
    hint?: string;
    retryable?: boolean;
    status?: number;
    details?: any;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
}
