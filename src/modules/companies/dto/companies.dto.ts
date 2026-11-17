import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  Length,
  ValidateIf,
  IsUrl,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { companyName } from '../company-name.js';
const optional = (_: unknown, value: unknown) =>
  value !== undefined && value !== null;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
export class CreateCompanyDto {
  @ApiProperty({
    example: "Orange Côte d'Ivoire",
    minLength: 1,
    maxLength: 150,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? companyName(value) : value,
  )
  @IsString()
  @Length(1, 150)
  name!: string;
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  industry?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 2048, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
    allow_protocol_relative_urls: false,
  })
  website?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  country?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  city?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 255, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  address?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  description?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 5000, nullable: true })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 5000)
  notes?: string | null;
}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto, {
  skipNullProperties: false,
}) {}
const integer = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    ? Number(value)
    : value;
export class ListCompaniesDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page: number = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' })
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE';
  @ApiPropertyOptional({
    enum: ['name', 'createdAt', 'updatedAt'],
    default: 'name',
  })
  @IsIn(['name', 'createdAt', 'updatedAt'])
  sortBy: 'name' | 'createdAt' | 'updatedAt' = 'name';
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  search?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  industry?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  country?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  city?: string;
}
export class CompanyDto {
  @ApiProperty({ type: String, nullable: false, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: false }) name!: string;
  @ApiProperty({ type: String, nullable: true }) industry!: string | null;
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, nullable: false, enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: false, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, nullable: false, format: 'date-time' })
  updatedAt!: Date;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: Date | null;
}
export class CompanyPageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class CompanyPageDto {
  @ApiProperty({ type: [CompanyDto] }) data!: CompanyDto[];
  @ApiProperty({ type: CompanyPageMetaDto }) meta!: CompanyPageMetaDto;
}
