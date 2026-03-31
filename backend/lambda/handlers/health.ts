/**
 * Health Check Lambda Handler with DynamoDB
 * 
 * Extends the basic health check to verify DynamoDB connectivity.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({});

interface HealthResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    version: string;
    region: string;
    database: {
        connected: boolean;
        tableName: string;
        itemCount?: number;
    };
}

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {
    console.log('Health check requested', {
        requestId: context.awsRequestId,
    });

    const tableName = process.env.TABLE_NAME || 'ContactFormLeads';
    let dbConnected = false;
    let itemCount: number | undefined;
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    try {
        // Verify DynamoDB table is accessible
        const command = new DescribeTableCommand({ TableName: tableName });
        const response = await dynamoClient.send(command);

        dbConnected = response.Table?.TableStatus === 'ACTIVE';
        itemCount = response.Table?.ItemCount;

        if (!dbConnected) {
            status = 'degraded';
        }
    } catch (error) {
        console.error('DynamoDB health check failed', error);
        status = 'unhealthy';
    }

    const response: HealthResponse = {
        status,
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        region: process.env.AWS_REGION || 'unknown',
        database: {
            connected: dbConnected,
            tableName,
            itemCount,
        },
    };

    return {
        statusCode: status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(response),
    };
};