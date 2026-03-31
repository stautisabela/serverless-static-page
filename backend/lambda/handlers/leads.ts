import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    UpdateItemCommand,
    DeleteItemCommand,
    ScanCommand,
    QueryCommand,
} from '@aws-sdk/client-dynamodb';

import {
  marshall,
  unmarshall,
} from '@aws-sdk/util-dynamodb';

// ============================================
// Configuration
// ============================================

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME || 'ContactFormLeads';
const EMAIL_INDEX = process.env.EMAIL_INDEX || 'email-index';
const STATUS_INDEX = process.env.STATUS_INDEX || 'status-index';

// ============================================
// Types
// ============================================

// Lead interface
interface Lead {
  leadId: string;
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
  status: "new" | "contacted" | "qualified" | "converted";
  createdAt: string;
  updatedAt: string;
}

interface CreateLeadRequest {
    name: string;
    email: string;
    company?: string;
    subject: string;
    message: string;
}

interface UpdateLeadRequest {
    name?: string;
    email?: string;
    company?: string;
    subject?: string;
    message?: string;
    status?: Lead['status'];
}

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

// ============================================
// Utility Functions
// ============================================

function generateId(): string {
    return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validateCreateRequest(body: any): { valid: boolean; error?: string } {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
        return { valid: false, error: 'Name is required (min 2 characters)' };
    }
    if (!body.email || !isValidEmail(body.email)) {
        return { valid: false, error: 'Valid email is required' };
    }
    if (!body.subject || typeof body.subject !== 'string') {
        return { valid: false, error: 'Subject is required' };
    }
    if (!body.message || typeof body.message !== 'string' || body.message.trim().length < 10) {
        return { valid: false, error: 'Message is required (min 10 characters)' };
    }
    return { valid: true };
}

function createResponse<T>(statusCode: number, body: ApiResponse<T>): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify(body),
    };
}

// ============================================
// DynamoDB Operations
// ============================================

/**
 * Create a new lead in DynamoDB
 */
async function createLead(leadData: CreateLeadRequest): Promise<Lead> {
    const now = new Date().toISOString();

    const lead: Lead = {
        leadId: generateId(),
        name: leadData.name.trim(),
        email: leadData.email.trim().toLowerCase(),
        company: leadData.company?.trim() || undefined,
        subject: leadData.subject,
        message: leadData.message.trim(),
        status: 'new',
        createdAt: now,
        updatedAt: now,
    };

    const command = new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(lead, { removeUndefinedValues: true }),
        // Ensure we don't overwrite an existing lead
        ConditionExpression: 'attribute_not_exists(leadId)',
    });

    await dynamoClient.send(command);
    console.log('Lead created', { leadId: lead.leadId, email: lead.email });

    return lead;
}

/**
 * Get a lead by ID
 */
async function getLeadById(leadId: string): Promise<Lead | null> {
    const command = new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ leadId }),
    });

    const response = await dynamoClient.send(command);

    if (!response.Item) {
        return null;
    }

    return unmarshall(response.Item) as Lead;
}

/**
 * Get all leads (with optional status filter)
 */
async function getAllLeads(status?: string): Promise<Lead[]> {
    let command;

    if (status) {
        // Use GSI to query by status
        command = new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: STATUS_INDEX,
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: marshall({
                ':status': status,
            }),
            // Sort by creation date descending
            ScanIndexForward: false,
        });
    } else {
        // Scan all items
        command = new ScanCommand({
            TableName: TABLE_NAME,
        });
    }

    const response = await dynamoClient.send(command);

    const leads = (response.Items || []).map(item => unmarshall(item) as Lead);

    // Sort by createdAt descending if we did a Scan
    if (!status) {
        leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return leads;
}

/**
 * Get leads by email using GSI
 */
async function getLeadsByEmail(email: string): Promise<Lead[]> {
    const command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: EMAIL_INDEX,
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: marshall({
            ':email': email.toLowerCase(),
        }),
        ScanIndexForward: false,
    });

    const response = await dynamoClient.send(command);

    return (response.Items || []).map(item => unmarshall(item) as Lead);
}

/**
 * Update a lead
 */
async function updateLead(leadId: string, updates: UpdateLeadRequest): Promise<Lead | null> {
    // Build update expression dynamically
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Always update the updatedAt timestamp
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    // Add each field that has a value
    if (updates.name !== undefined) {
        updateExpressions.push('#name = :name');
        expressionAttributeNames['#name'] = 'name';
        expressionAttributeValues[':name'] = updates.name.trim();
    }

    if (updates.email !== undefined) {
        updateExpressions.push('#email = :email');
        expressionAttributeNames['#email'] = 'email';
        expressionAttributeValues[':email'] = updates.email.toLowerCase().trim();
    }

    if (updates.company !== undefined) {
        updateExpressions.push('#company = :company');
        expressionAttributeNames['#company'] = 'company';
        expressionAttributeValues[':company'] = updates.company.trim();
    }

    if (updates.subject !== undefined) {
        updateExpressions.push('#subject = :subject');
        expressionAttributeNames['#subject'] = 'subject';
        expressionAttributeValues[':subject'] = updates.subject;
    }

    if (updates.message !== undefined) {
        updateExpressions.push('#message = :message');
        expressionAttributeNames['#message'] = 'message';
        expressionAttributeValues[':message'] = updates.message.trim();
    }

    if (updates.status !== undefined) {
        updateExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = updates.status;
    }

    const command = new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ leadId }),
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
        // Ensure the item exists
        ConditionExpression: 'attribute_exists(leadId)',
        ReturnValues: 'ALL_NEW',
    });

    try {
        const response = await dynamoClient.send(command);
        console.log('Lead updated', { leadId });
        return unmarshall(response.Attributes!) as Lead;
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            return null;
        }
        throw error;
    }
}

/**
 * Delete a lead
 */
async function deleteLead(leadId: string): Promise<boolean> {
    const command = new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ leadId }),
        ConditionExpression: 'attribute_exists(leadId)',
    });

    try {
        await dynamoClient.send(command);
        console.log('Lead deleted', { leadId });
        return true;
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            return false;
        }
        throw error;
    }
}

// ============================================
// Main Handler
// ============================================

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {
    const { httpMethod, pathParameters, body, queryStringParameters } = event;
    const leadId = pathParameters?.id;

    console.log('Request received', {
        requestId: context.awsRequestId,
        method: httpMethod,
        leadId,
        queryParams: queryStringParameters,
    });

    try {
        switch (httpMethod) {
            // ==================
            // POST /leads - Create new lead
            // ==================
            case 'POST': {
                if (!body) {
                    return createResponse(400, { success: false, error: 'Request body required' });
                }

                let parsedBody: CreateLeadRequest;
                try {
                    parsedBody = JSON.parse(body);
                } catch {
                    return createResponse(400, { success: false, error: 'Invalid JSON' });
                }

                const validation = validateCreateRequest(parsedBody);
                if (!validation.valid) {
                    return createResponse(400, { success: false, error: validation.error });
                }

                const lead = await createLead(parsedBody);

                return createResponse(201, {
                    success: true,
                    data: lead,
                    message: 'Lead created successfully',
                });
            }

            // ==================
            // GET /leads or GET /leads/{id}
            // ==================
            case 'GET': {
                if (leadId) {
                    // Get single lead
                    const lead = await getLeadById(leadId);

                    if (!lead) {
                        return createResponse(404, { success: false, error: 'Lead not found' });
                    }

                    return createResponse(200, { success: true, data: lead });
                } else {
                    // List leads (with optional filters)
                    const status = queryStringParameters?.status;
                    const email = queryStringParameters?.email;

                    let leads: Lead[];

                    if (email) {
                        leads = await getLeadsByEmail(email);
                    } else {
                        leads = await getAllLeads(status);
                    }

                    return createResponse(200, {
                        success: true,
                        data: leads,
                        message: `Found ${leads.length} lead(s)`,
                    });
                }
            }

            // ==================
            // PUT /leads/{id} - Update lead
            // ==================
            case 'PUT': {
                if (!leadId) {
                    return createResponse(400, { success: false, error: 'Lead ID required' });
                }

                if (!body) {
                    return createResponse(400, { success: false, error: 'Request body required' });
                }

                let parsedBody: UpdateLeadRequest;
                try {
                    parsedBody = JSON.parse(body);
                } catch {
                    return createResponse(400, { success: false, error: 'Invalid JSON' });
                }

                const updatedLead = await updateLead(leadId, parsedBody);

                if (!updatedLead) {
                    return createResponse(404, { success: false, error: 'Lead not found' });
                }

                return createResponse(200, {
                    success: true,
                    data: updatedLead,
                    message: 'Lead updated successfully',
                });
            }

            // ==================
            // DELETE /leads/{id} - Delete lead
            // ==================
            case 'DELETE': {
                if (!leadId) {
                    return createResponse(400, { success: false, error: 'Lead ID required' });
                }

                const deleted = await deleteLead(leadId);

                if (!deleted) {
                    return createResponse(404, { success: false, error: 'Lead not found' });
                }

                return createResponse(200, {
                    success: true,
                    message: 'Lead deleted successfully',
                });
            }

            default:
                return createResponse(405, { success: false, error: 'Method not allowed' });
        }
    } catch (error: any) {
        console.error('Unhandled error', error);

        return createResponse(500, {
            success: false,
            error: 'Internal server error',
        });
    }
};