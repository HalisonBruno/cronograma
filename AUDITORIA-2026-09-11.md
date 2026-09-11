# Atualização de 11/09/2026

## Cronograma e progresso

O perfil usa até 90 minutos de segunda a sexta. Questões não consomem esse teto; sábado e domingo não recebem atividades. O calendário contínuo corrige as semanas ausentes entre fevereiro e abril. A data de abril de 2027 continua sendo uma hipótese de planejamento, não uma confirmação de edital.

Regenerar reconstrói todas as atividades pendentes, inclusive futuras, e preserva conclusões e seus horários. A prévia mostra datas, capacidade e motivos do que permanece na biblioteca. Há desfazer. No cenário limpo testado em 08/09/2026, todos os 1.796 informativos recebem datas em 159 dias úteis, com máximo de 90 minutos por dia. Se o prazo se tornar insuficiente, o déficit é mostrado: os informativos não são cortados silenciosamente.

O contador inclui todos os informativos, deduplica chaves repetidas e mantém créditos de equivalências distintas sem duplicar minutos. A migração de datas aguarda o primeiro carregamento da nuvem; falha de conexão não autoriza sobrescrever o plano remoto.

A sugestão de questões acompanha as matérias efetivamente estudadas na data, mesmo fora de ordem; na ausência de conclusões, usa o plano regenerado. Não fica presa à matéria da grade original.

## Lei seca

Foram recompostos 123 arquivos, correspondentes a todos os 467 grupos cadastrados, incluindo referências antigas não usadas como tarefas. São 4.072 ocorrências de dispositivos; 2.745 foram modificadas ou recompostas em relação ao conteúdo anterior. Isso não significa 2.745 alterações legislativas: inclui correções de extração, recortes e grupos sem texto.

O leitor abre o arquivo e o grupo exatos, inclusive identificadores com `~`. Nunca substitui um trecho ausente por outro. A página da matéria usa os mesmos blocos pequenos e o mesmo leitor da Home, sem ressuscitar as antigas seleções gigantescas como tarefas. Frações de artigos param no dispositivo anunciado, inclusive quando são a última fração.

Fontes oficiais capturadas, datas e hashes: [manifesto da auditoria](auditoria-lei-seca.json). A coleta verifica fonte e integridade; não é uma certificação jurídica ou promessa de atualização automática futura. Casos especiais de transcrição e interpretação da estrutura estão registrados em [revisões especiais](scripts/law-special-review.json) e [recortes conferidos](scripts/law-reading-overrides.json).

Pontos temporais conferidos: a [Lei 15.484/2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/l15484.htm) prevê vigência após 30 dias e foi incorporada aos dispositivos do CPC selecionados. A [Lei 15.479/2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/l15479.htm) prevê vacância de um ano; o regime futuro não é apresentado como vigente hoje. O CTN consolidado incorpora a [LC 236/2026](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp236.htm), com nota distinguindo sua vigência dos prazos de adaptação.

Os DOCX anteriores do Google Drive não foram atualizados nesta entrega. Estão expressamente identificados como referências antigas; o texto recomposto e suas fontes estão no leitor do aplicativo.

## Dados preservados e testes

Pesos, prioridades, mapas de incidência, conteúdo dos informativos e identificadores originais foram preservados. Em `DATA`, somente rótulos de leitura e endereços diretos de fontes foram acrescentados. Os testes comparam todo o restante à versão anterior.

Suítes: `study-minutes.js`, `tec-notebooks.js`, `equivalence-regressions.js`, `scheduler-budget.js`, `startup-progress.js`, `law-interface.js`, `law-parser.py` e `law-content.py`. Usam o código real da página em DOM isolado e arquivos publicados, sem acessar ou modificar a conta do estudante.

Conferência adicional no navegador, em perfil local sem sincronizar: Home de 11/09 com 90 minutos, sábado de 12/09 sem tarefas, leitura integral de informativo e leitor dos arts. 35–36 da LOMAN com fonte oficial e data da revisão. Nenhuma conclusão da conta foi marcada como teste.
