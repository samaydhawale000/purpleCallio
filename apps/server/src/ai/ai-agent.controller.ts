import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { AiEnabledGuard } from './guards/ai-enabled.guard';
import { AiAgentService } from './ai-agent.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { ListAgentsQueryDto } from './dto/list-agents.dto';
import { CreateToolDto, TestToolDto, UpdateToolDto } from './dto/tool.dto';
import { AiToolGatewayService } from './tools/ai-tool-gateway.service';

/**
 * Customer-facing agent and tool CRUD, scoped to projects the JWT's user
 * owns. AiEnabledGuard runs first so a disabled flag always wins.
 */
@UseGuards(AiEnabledGuard, JwtGuard)
@Controller('ai/agents')
export class AiAgentController {
  constructor(
    private agents: AiAgentService,
    private toolGateway: AiToolGatewayService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@Req() req: any, @Body() body: CreateAgentDto) {
    return this.agents.createAgent(req.user.userId, body);
  }

  @Get()
  list(@Req() req: any, @Query() query: ListAgentsQueryDto) {
    return this.agents.listAgents(req.user.userId, query.projectId);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.agents.getAgent(req.user.userId, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateAgentDto,
  ) {
    return this.agents.updateAgent(req.user.userId, id, body);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.agents.deleteAgent(req.user.userId, id);
  }

  @Get(':id/versions')
  versions(@Req() req: any, @Param('id') id: string) {
    return this.agents.listVersions(req.user.userId, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/tools')
  createTool(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CreateToolDto,
  ) {
    return this.agents.createTool(req.user.userId, id, body);
  }

  @Get(':id/tools')
  listTools(@Req() req: any, @Param('id') id: string) {
    return this.agents.listTools(req.user.userId, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':id/tools/:toolId')
  updateTool(
    @Req() req: any,
    @Param('id') id: string,
    @Param('toolId') toolId: string,
    @Body() body: UpdateToolDto,
  ) {
    return this.agents.updateTool(req.user.userId, id, toolId, body);
  }

  /** Dashboard "Test call": sample arguments through the tool gateway. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/tools/:toolId/test')
  testTool(
    @Req() req: any,
    @Param('id') id: string,
    @Param('toolId') toolId: string,
    @Body() body: TestToolDto,
  ) {
    return this.toolGateway.testTool(
      req.user.userId,
      id,
      toolId,
      body.arguments ?? {},
    );
  }

  @Delete(':id/tools/:toolId')
  removeTool(
    @Req() req: any,
    @Param('id') id: string,
    @Param('toolId') toolId: string,
  ) {
    return this.agents.deleteTool(req.user.userId, id, toolId);
  }
}
