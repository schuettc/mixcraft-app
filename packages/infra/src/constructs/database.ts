import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseConstruct extends Construct {
  public readonly usersTable: Table;
  public readonly apiKeysTable: Table;
  public readonly userMusicTokensTable: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // UsersTable: PK userId (string) -> email, createdAt, plan
    this.usersTable = new Table(this, 'UsersTable', {
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ApiKeysTable: PK keyHash (string) -> userId, keyPrefix, name, createdAt, lastUsedAt, isActive
    this.apiKeysTable = new Table(this, 'ApiKeysTable', {
      partitionKey: { name: 'keyHash', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // GSI: UserIdIndex (PK: userId, SK: createdAt) for listing keys by user
    this.apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
    });

    // UserMusicTokensTable: PK userId (string), SK service (string) -> encryptedToken, connectedAt, updatedAt
    this.userMusicTokensTable = new Table(this, 'UserMusicTokensTable', {
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'service', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
