import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

// Lead interface
interface Lead {
  id: string;
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
  status: "new" | "contacted" | "qualified" | "converted";
  createdAt: string;
  updatedAt: string;
}

// In-memory storage (replaced with DynamoDB in Part 3)
const leadsStorage: Map<string, Lead> = new Map();

// Generate unique ID
function generateId(): string {
  return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Validate create request
function validateCreateRequest(body: any): { valid: boolean; error?: string } {
  if (!body.name || body.name.length < 2) {
    return { valid: false, error: "Name is required (min 2 characters)" };
  }
  if (!body.email || !body.email.includes("@")) {
    return { valid: false, error: "Valid email is required" };
  }
  if (!body.message || body.message.length < 10) {
    return { valid: false, error: "Message is required (min 10 characters)" };
  }
  return { valid: true };
}

// Create standardized response
function createResponse(
  statusCode: number,
  body: object,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// Main handler
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body } = event;
  const leadId = pathParameters?.id;

  console.log("Request:", {
    method: httpMethod,
    leadId,
    requestId: context.awsRequestId,
  });

  try {
    switch (httpMethod) {
      // Create new lead
      case "POST": {
        const parsedBody = JSON.parse(body || "{}");
        const validation = validateCreateRequest(parsedBody);

        if (!validation.valid) {
          return createResponse(400, {
            success: false,
            error: validation.error,
          });
        }

        const now = new Date().toISOString();
        const lead: Lead = {
          id: generateId(),
          name: parsedBody.name.trim(),
          email: parsedBody.email.toLowerCase().trim(),
          company: parsedBody.company?.trim(),
          subject: parsedBody.subject || "general",
          message: parsedBody.message.trim(),
          status: "new",
          createdAt: now,
          updatedAt: now,
        };

        leadsStorage.set(lead.id, lead);
        console.log("Lead created:", lead.id);

        return createResponse(201, {
          success: true,
          data: lead,
          message: "Lead created successfully",
        });
      }

      // List all leads
      case "GET": {
        if (leadId) {
          const lead = leadsStorage.get(leadId);
          if (!lead) {
            return createResponse(404, {
              success: false,
              error: "Lead not found",
            });
          }
          return createResponse(200, { success: true, data: lead });
        }

        const leads = Array.from(leadsStorage.values());
        return createResponse(200, {
          success: true,
          data: leads,
          message: `Found ${leads.length} lead(s)`,
        });
      }

      // Update lead
      case "PUT": {
        if (!leadId) {
          return createResponse(400, {
            success: false,
            error: "Lead ID required",
          });
        }

        const lead = leadsStorage.get(leadId);
        if (!lead) {
          return createResponse(404, {
            success: false,
            error: "Lead not found",
          });
        }

        const updates = JSON.parse(body || "{}");
        const updatedLead: Lead = {
          ...lead,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        leadsStorage.set(leadId, updatedLead);
        return createResponse(200, { success: true, data: updatedLead });
      }

      // Delete lead
      case "DELETE": {
        if (!leadId) {
          return createResponse(400, {
            success: false,
            error: "Lead ID required",
          });
        }

        const deleted = leadsStorage.delete(leadId);
        if (!deleted) {
          return createResponse(404, {
            success: false,
            error: "Lead not found",
          });
        }

        return createResponse(200, { success: true, message: "Lead deleted" });
      }

      default:
        return createResponse(405, {
          success: false,
          error: "Method not allowed",
        });
    }
  } catch (error) {
    console.error("Error:", error);
    return createResponse(500, {
      success: false,
      error: "Internal server error",
    });
  }
};