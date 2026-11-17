import { EmptyCompanyBodyPipe } from './dto/empty-company-body.pipe.js';
import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiParam,
} from '@nestjs/swagger';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { CurrentActor, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CompaniesService } from './companies.service.js';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesDto,
  CompanyDto,
  CompanyPageDto,
} from './dto/companies.dto.js';
@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Créer une entreprise privée' })
  @ApiCreatedResponse({ type: CompanyDto })
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: CreateCompanyDto,
  ) {
    return this.companies.create(actor, body);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Lister ses entreprises actives par défaut' })
  @ApiOkResponse({ type: CompanyPageDto })
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: ListCompaniesDto,
  ) {
    return this.companies.list(actor, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Consulter une entreprise' })
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.companies.get(actor, id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Modifier une entreprise' })
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCompanyDto,
  ) {
    return this.companies.update(actor, id, body);
  }
  @Post(':id/archive')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Archiver une entreprise (idempotent)' })
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  archive(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new EmptyCompanyBodyPipe()) _body: unknown,
  ) {
    void _body;
    return this.companies.archive(actor, id);
  }
  @Post(':id/restore')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Restaurer une entreprise (idempotent)' })
  @HttpCode(200)
  @ApiOkResponse({ type: CompanyDto })
  restore(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new EmptyCompanyBodyPipe()) _body: unknown,
  ) {
    void _body;
    return this.companies.restore(actor, id);
  }
  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Supprimer une entreprise sans relations métier' })
  @HttpCode(204)
  @ApiNoContentResponse()
  delete(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new EmptyCompanyBodyPipe()) _body: unknown,
  ) {
    void _body;
    return this.companies.delete(actor, id);
  }
}
